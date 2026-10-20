import { afterEach, describe, expect, it, vi } from "vitest";

import {
  checkPasswordPwned,
  PwnedCheckError,
  sha1HexUpper,
} from "./pwned-passwords";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
const PASSWORD_HASH = "5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8";
const PREFIX = PASSWORD_HASH.slice(0, 5);
const SUFFIX = PASSWORD_HASH.slice(5);

function rangeResponse(lines: string[]): Response {
  return new Response(lines.join("\r\n"), { status: 200 });
}

function stubFetch(body: string[] | Response | (() => Promise<Response>)) {
  const mock = vi.fn(
    typeof body === "function"
      ? body
      : () => Promise.resolve(Array.isArray(body) ? rangeResponse(body) : body),
  );
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sha1HexUpper", () => {
  it("returns the uppercase hex SHA-1 digest", async () => {
    await expect(sha1HexUpper("password")).resolves.toBe(PASSWORD_HASH);
    await expect(sha1HexUpper("")).resolves.toBe(
      "DA39A3EE5E6B4B0D3255BFEF95601890AFD80709",
    );
  });
});

describe("checkPasswordPwned", () => {
  it("requests only the 5-char prefix with the padding header", async () => {
    const fetchMock = stubFetch([]);
    await checkPasswordPwned("password");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(`https://api.pwnedpasswords.com/range/${PREFIX}`);
    expect(url).not.toContain(PASSWORD_HASH);
    expect((init.headers as Record<string, string>)["Add-Padding"]).toBe(
      "true",
    );
    expect(init.credentials).toBe("omit");
  });

  it("reports pwned with the breach count when the suffix matches", async () => {
    stubFetch([`AAAAABBBBB:12`, `${SUFFIX}:3861493`, `CCCCC:7`]);
    await expect(checkPasswordPwned("password")).resolves.toEqual({
      pwned: true,
      count: 3861493,
    });
  });

  it("reports not pwned when the suffix is absent", async () => {
    stubFetch(["AAAAABBBBB:12", "0123456789:1"]);
    await expect(checkPasswordPwned("password")).resolves.toEqual({
      pwned: false,
      count: 0,
    });
  });

  it("treats a zero-count (padding) suffix match as not pwned", async () => {
    stubFetch([`${SUFFIX}:0`]);
    await expect(checkPasswordPwned("password")).resolves.toEqual({
      pwned: false,
      count: 0,
    });
  });

  it("ignores malformed lines", async () => {
    stubFetch(["not-a-line", `${SUFFIX.replace("E", "F")}:oops`, `${SUFFIX}:42`]);
    await expect(checkPasswordPwned("password")).resolves.toEqual({
      pwned: true,
      count: 42,
    });
  });

  it("throws a typed network error when fetch fails", async () => {
    stubFetch(() => Promise.reject(new TypeError("fetch failed")));
    const err = await checkPasswordPwned("password").catch((e) => e);
    expect(err).toBeInstanceOf(PwnedCheckError);
    expect(err.kind).toBe("network");
  });

  it("throws a typed http error on non-200 responses", async () => {
    stubFetch(new Response("rate limited", { status: 429 }));
    const err = await checkPasswordPwned("password").catch((e) => e);
    expect(err).toBeInstanceOf(PwnedCheckError);
    expect(err.kind).toBe("http");
    expect(err.status).toBe(429);
  });

  it("throws a typed aborted error when the request is cancelled", async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(() => {
      throw new DOMException("The operation was aborted", "AbortError");
    });
    const err = await checkPasswordPwned("password", {
      signal: controller.signal,
    }).catch((e) => e);
    expect(err).toBeInstanceOf(PwnedCheckError);
    expect(err.kind).toBe("aborted");
  });
});
