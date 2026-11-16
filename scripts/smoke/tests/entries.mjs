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
  searchBox,
  storage,
  unlock,
} from "../helpers.mjs";

const SEARCH_PLACEHOLDER = "Search entries…";
const SEARCH_HINT = "Search entries (press . to focus)…";
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
  const input = row.getByLabel("Add label", { exact: true });
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
    name: "service name autocomplete",
    async run({ page }) {
      const row = await addEntry(page);
      const name = field(row, "Name");
      const url = field(row, "URL");
      await name.pressSequentially("Net");
      const ghost = row.getByTestId("name-completion");
      await ghost.waitFor();
      assert((await ghost.textContent()).startsWith("flix"), "no \"flix\" completion after \"Net\"");
      await name.press("Tab");
      assert((await name.inputValue()) === "Netflix", `Tab left the name "${await name.inputValue()}"`);
      assert((await url.inputValue()) === "https://netflix.com", `URL not filled: "${await url.inputValue()}"`);
      // A URL that's already set is kept.
      await url.fill("https://example.com/n");
      await name.fill("");
      await name.pressSequentially("spot");
      await ghost.waitFor();
      await name.press("Tab");
      assert((await name.inputValue()) === "Spotify", `Tab left the name "${await name.inputValue()}"`);
      assert((await url.inputValue()) === "https://example.com/n", "a set URL was overwritten");
      // Touch screens: no ghost text, the browser's own list of service names.
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 1 });
      try {
        await name.fill("");
        await url.fill("");
        await name.pressSequentially("Net");
        await row.locator('input[list="service-names"]').waitFor();
        assert(!(await ghost.count()), "ghost text shown on a touch screen");
        assert(await page.locator('datalist#service-names option[value="Netflix"]').count(), "Netflix missing from the list");
        // Picking from the list (browser UI) arrives as an insertReplacementText input.
        await name.evaluate((el) => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, "Netflix");
          el.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertReplacementText" }));
        });
        assert((await name.inputValue()) === "Netflix", `the pick left the name "${await name.inputValue()}"`);
        assert((await url.inputValue()) === "https://netflix.com", `URL not filled by the pick: "${await url.inputValue()}"`);
        // Typing isn't a pick: "Google" on the way to "Google Docs" leaves the URL
        // empty until the field is left.
        await name.fill("");
        await url.fill("");
        await name.pressSequentially("Google");
        assert((await url.inputValue()) === "", `typing filled the URL: "${await url.inputValue()}"`);
        await name.blur();
        assert((await url.inputValue()) === "https://google.com", `leaving the field didn't fill the URL: "${await url.inputValue()}"`);
      } finally {
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: false });
        await cdp.detach();
      }
      await row.getByRole("button", { name: "Delete" }).click(); // confirm() is accepted
      await row.waitFor({ state: "detached" });
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
    name: "+ Add off while the new entry is blank",
    async run({ page }) {
      const add = page.getByRole("button", { name: "+ Add" });
      assert(await add.isEnabled(), "+ Add disabled with no entry open");
      const row = await addEntry(page);
      assert(await add.isDisabled(), "+ Add enabled while the new entry is blank");
      assert(
        (await add.getAttribute("title")) === "Fill in or close the new entry before adding another",
        "disabled + Add has no hint",
      );
      await field(row, "Name").fill("Draft");
      assert(await add.isEnabled(), "+ Add still disabled after typing a name");
      await field(row, "Name").fill("");
      assert(await add.isDisabled(), "+ Add enabled after the name was cleared");
      await row.getByRole("button", { name: "Delete" }).click(); // confirm() is accepted
      await row.waitFor({ state: "detached" });
      assert(await add.isEnabled(), "+ Add disabled after the blank entry was deleted");
      // Closing a blank new entry drops it…
      const names = await entryNames(page);
      await closeEntry(await addEntry(page));
      await expectList(page, names);
      assert(await add.isEnabled(), "+ Add disabled after the blank entry was closed");
      // Collapsing it from its own row header (focus mode hides the other
      // rows here, so that's the other way to leave it).
      await (await addEntry(page)).getByRole("button", { name: "Collapse Untitled" }).click();
      await expectList(page, names);
      assert(await add.isEnabled(), "+ Add disabled after the blank entry was collapsed");
      // …but one with something typed in stays, unsaved.
      const draft = await addEntry(page, { name: "Draft" });
      await closeEntry(draft);
      await expectList(page, ["Draft", ...names]);
      const reopened = await openEntry(page, "Draft");
      await reopened.getByRole("button", { name: "Delete" }).click(); // confirm() is accepted
      await reopened.waitFor({ state: "detached" });
      await expectList(page, names);
    },
  },
  {
    name: "existing labels listed in the label input",
    async run({ page }) {
      const row = await addEntry(page, { name: "Label picker" });
      const input = row.getByLabel("Add label", { exact: true });
      const existing = row.getByRole("group", { name: "Existing labels" });
      const matching = row.getByRole("group", { name: "Matching labels" });
      const pick = (label) => row.getByRole("button", { name: `Add label ${label}`, exact: true });
      assert(!(await existing.count()), "existing labels listed before the input has focus");
      await input.focus();
      await existing.waitFor();
      assert(await pick("dev").count(), "\"dev\" not listed");
      assert(await pick("work").count(), "\"work\" not listed");
      await pick("dev").click();
      await row.getByRole("button", { name: "Remove label dev" }).waitFor();
      assert(!(await pick("dev").count()), "\"dev\" still listed once added");
      assert(await input.evaluate((el) => el === document.activeElement), "focus left the label input after a pick");
      // Keyboard pick: ArrowDown onto the chip, Enter — focus comes back to the input.
      await page.keyboard.press("ArrowDown");
      assert(await pick("work").evaluate((el) => el === document.activeElement), "ArrowDown didn't reach the chip");
      await page.keyboard.press("Enter");
      await row.getByRole("button", { name: "Remove label work" }).waitFor();
      assert(await input.evaluate((el) => el === document.activeElement), "focus lost after a keyboard pick");
      await row.getByRole("button", { name: "Remove label work" }).click();
      await input.focus();
      await existing.waitFor();
      // Chips aren't tab stops: Tab leaves the label input for the next field.
      assert((await pick("work").getAttribute("tabindex")) === "-1", "label chip is a tab stop");
      // Escape hides the list; typing brings it back.
      await input.press("Escape");
      await existing.waitFor({ state: "detached" });
      assert(await input.evaluate((el) => el === document.activeElement), "Escape moved focus");
      await input.fill("wo");
      await matching.waitFor();
      assert(await pick("work").count() && !(await pick("dev").count()), "typing didn't filter the list");
      await input.fill("zzz-new");
      await row.getByText("Press Enter to add").waitFor();
      assert(!(await matching.count()) && !(await existing.count()), "labels listed for an unmatched name");
      await input.fill("");
      await field(row, "Name").focus();
      await existing.waitFor({ state: "detached" });
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
    name: "multi-term search, . to focus",
    async run({ page }) {
      const search = searchBox(page);
      const placeholder = () => search.getAttribute("placeholder");
      const searchFocused = () => search.evaluate((el) => el === document.activeElement);
      const pressDotAway = async () => {
        await search.evaluate((el) => el.blur());
        await page.keyboard.press(".");
      };
      await pressDotAway();
      assert(await searchFocused(), "\".\" didn't focus the search box");
      assert((await search.inputValue()) === "", "\".\" was typed into the search box");
      assert((await placeholder()) === SEARCH_PLACEHOLDER, `focused placeholder is "${await placeholder()}"`);
      await search.evaluate((el) => el.blur());
      assert((await placeholder()) === SEARCH_HINT, `unfocused placeholder is "${await placeholder()}"`);
      const row = await openEntry(page, "GitHub");
      await pressDotAway();
      assert(!(await searchFocused()), "\".\" focused the search box while an entry is open");
      await notesField(row).press(".");
      await notesField(row).press("Backspace");
      assert(!(await searchFocused()), "\".\" typed in a field focused the search box");
      await closeEntry(row);
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
      // Colour-coded: each label chip has its own palette accent ("work" and
      // "dev" differ), each brand icon its brand tint (GitLab) unless the brand
      // is black/white (GitHub keeps the text colour), and a letter avatar is
      // a solid accent.
      const bg = (loc) => loc.evaluate((el) => getComputedStyle(el).backgroundColor);
      const color = (loc) => loc.evaluate((el) => getComputedStyle(el).color);
      const work = await bg(entryRow(page, "Notion").getByRole("button", { name: "work", exact: true }));
      const dev = await bg(entryRow(page, "GitHub").getByRole("button", { name: "dev", exact: true }));
      assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(work), "label chip has no colour");
      assert(work !== dev, `labels "work" and "dev" share the colour ${work}`);
      const text = await color(page.locator("body"));
      const github = await color(entryRow(page, "GitHub").getByRole("img", { name: "GitHub" }));
      const gitlab = await color(entryRow(page, "Spacey").getByRole("img", { name: "GitLab" }));
      assert(github === text, `GitHub icon is ${github}, expected the text colour ${text}`);
      assert(gitlab !== text, "GitLab icon isn't brand-tinted");
      const avatar = entryRow(page, ENTRY).locator("span[aria-hidden]").first();
      assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(await bg(avatar)), "letter avatar has no colour");
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
