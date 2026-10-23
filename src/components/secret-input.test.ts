import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { PropertyValueInput, SecretField } from "./secret-input";

const SECRET = "hunter2-Probe-Secret";

describe("PropertyValueInput", () => {
  it("never renders the value as an HTML attribute", () => {
    const html = renderToStaticMarkup(
      createElement(PropertyValueInput, { type: "password", value: SECRET, onValueChange: () => {} }),
    );
    expect(html).toContain("<input");
    expect(html).not.toContain(SECRET);
    expect(html).not.toMatch(/\svalue=/);
  });
});

describe("SecretField", () => {
  it("renders a fixed-length mask and no input while hidden", () => {
    const html = renderToStaticMarkup(
      createElement(SecretField, {
        value: SECRET,
        onValueChange: () => {},
        label: "Password",
        className: "",
        toggleClassName: "",
      }),
    );
    expect(html).not.toContain(SECRET);
    expect(html).not.toContain("<input");
    expect(html).toContain("••••••••");
    expect(
      renderToStaticMarkup(
        createElement(SecretField, { value: "x", readOnly: true, label: "P", className: "", toggleClassName: "" }),
      ),
    ).toContain("••••••••");
  });

  it("shows the input directly for an empty editable field", () => {
    const html = renderToStaticMarkup(
      createElement(SecretField, {
        value: "",
        onValueChange: () => {},
        label: "Password",
        className: "",
        toggleClassName: "",
      }),
    );
    expect(html).toContain('type="password"');
  });
});
