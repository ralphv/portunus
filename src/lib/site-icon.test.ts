import { describe, expect, it } from "vitest";
import * as simpleIcons from "simple-icons";
import { EXTRA_SITE_ICONS } from "./site-icon-extra";
import {
  SITE_ICON_SLUGS,
  siteIcon,
  serviceNameCompletion,
  serviceUrl,
  siteIconSlug,
} from "./site-icon";

const PACKAGE_SLUGS = new Set(
  Object.values(simpleIcons)
    .filter((i) => i && typeof i === "object" && "slug" in i)
    .map((i) => i.slug as string),
);

describe("siteIconSlug", () => {
  it("resolves bare hostnames and strips www.", () => {
    expect(siteIconSlug("github.com", "")).toBe("github");
    expect(siteIconSlug("https://www.github.com/u", "")).toBe("github");
  });

  it("walks suffixes so subdomains inherit the brand", () => {
    expect(siteIconSlug("https://login.ubisoft.com/x", "")).toBe("ubisoft");
    expect(siteIconSlug("https://mail.ebay.com", "")).toBe("ebay");
  });

  it("prefers service-specific subdomains over the parent brand", () => {
    expect(siteIconSlug("mail.google.com", "")).toBe("gmail");
    expect(siteIconSlug("accounts.google.com", "")).toBe("google");
    expect(siteIconSlug("drive.google.com", "")).toBe("googledrive");
    expect(siteIconSlug("tv.youtube.com", "")).toBe("youtubetv");
    expect(siteIconSlug("youtube.com", "")).toBe("youtube");
  });

  it("resolves vendored brands absent from the package", () => {
    expect(siteIconSlug("amazon.com", "")).toBe("amazon");
    expect(siteIconSlug("https://aws.amazon.com/console", "")).toBe(
      "amazonwebservices",
    );
    expect(siteIconSlug("outlook.com", "")).toBe("microsoftoutlook");
    expect(siteIconSlug("linkedin.com", "")).toBe("linkedin");
    expect(siteIconSlug("slack.com", "")).toBe("slack");
  });

  it("handles domain aliases", () => {
    expect(siteIconSlug("twitter.com", "")).toBe("x");
    expect(siteIconSlug("t.me", "")).toBe("telegram");
    expect(siteIconSlug("booking.com", "")).toBe("bookingdotcom");
  });

  it("treats a trailing root dot on the host as the same domain", () => {
    expect(siteIconSlug("https://github.com./", "My Site")).toBe("github");
  });

  it("falls back to the entry name normalized to a slug", () => {
    expect(siteIconSlug("", "GitHub")).toBe("github");
    expect(siteIconSlug("", "Netflix")).toBe("netflix");
    expect(siteIconSlug("", "My Bank")).toBeNull();
    expect(siteIconSlug("", "Coffee Rewards")).toBeNull();
  });

  it("spells out dots when normalizing dotted brand names", () => {
    expect(siteIconSlug("", "Booking.com")).toBe("bookingdotcom");
    expect(siteIconSlug("", "Hotels.com")).toBe("hotelsdotcom");
    expect(siteIconSlug("", "GOG.com")).toBe("gogdotcom");
  });

  it("matches the brand inside qualified names", () => {
    expect(siteIconSlug("", "Bank of America - John")).toBe("bankofamerica");
    expect(siteIconSlug("", "Netflix - work")).toBe("netflix");
    expect(siteIconSlug("", "John - Bank of America")).toBe("bankofamerica");
    expect(siteIconSlug("", "work GitHub")).toBe("github");
    expect(siteIconSlug("", "My Bank")).toBeNull();
  });

  it("honours an explicit override, ignoring unknown slugs", () => {
    expect(siteIconSlug("github.com", "", "netflix")).toBe("netflix");
    expect(siteIconSlug("github.com", "", "not-a-real-slug")).toBe("github");
    expect(siteIconSlug("", "", "not-a-real-slug")).toBeNull();
  });

  it("returns null for unknown and unparseable urls", () => {
    expect(siteIconSlug("https://corner-bakery.example", "")).toBeNull();
    expect(siteIconSlug("not a url", "")).toBeNull();
    expect(siteIconSlug("", "")).toBeNull();
  });
});

describe("icon data", () => {
  it("has icon data for every picker slug", () => {
    for (const slug of SITE_ICON_SLUGS) {
      const icon = siteIcon(slug);
      expect(icon, slug).toBeDefined();
      expect(icon!.path, slug).toBeTruthy();
      expect(icon!.title, slug).toBeTruthy();
    }
  });

  it("keeps picker slugs unique and in the package or vendored set", () => {
    expect(new Set(SITE_ICON_SLUGS).size).toBe(SITE_ICON_SLUGS.length);
    for (const slug of SITE_ICON_SLUGS) {
      expect(
        PACKAGE_SLUGS.has(slug) || slug in EXTRA_SITE_ICONS,
        slug,
      ).toBe(true);
    }
  });
});

describe("serviceNameCompletion", () => {
  it("completes a typed prefix to the service title, case-insensitively", () => {
    expect(serviceNameCompletion("Net")).toBe("Netflix");
    expect(serviceNameCompletion("netl")).toBe("Netlify");
    expect(serviceNameCompletion("bank of")).toBe("Bank of America");
  });

  it("prefers the shortest title", () => {
    expect(serviceNameCompletion("Goo")).toBe("Google");
    expect(serviceNameCompletion("Google D")).toBe("Google Docs");
  });

  it("needs two characters and a strict prefix", () => {
    expect(serviceNameCompletion("N")).toBeNull();
    expect(serviceNameCompletion("Netflix")).toBeNull();
    expect(serviceNameCompletion("Netflixx")).toBeNull();
    expect(serviceNameCompletion(" Net")).toBeNull();
    expect(serviceNameCompletion("")).toBeNull();
  });
});

describe("serviceUrl", () => {
  it("maps an exact service name or slug to its URL", () => {
    expect(serviceUrl("Netflix")).toBe("https://netflix.com");
    expect(serviceUrl(" netflix ")).toBe("https://netflix.com");
    expect(serviceUrl("Gmail")).toBe("https://mail.google.com");
    expect(serviceUrl("Bank of America")).toBe("https://bankofamerica.com");
  });

  it("returns null for unknown or partial names", () => {
    expect(serviceUrl("Netflix family")).toBeNull();
    expect(serviceUrl("Corner Bakery")).toBeNull();
    expect(serviceUrl("")).toBeNull();
  });

  it("fills URLs that resolve to the same icon as the name", () => {
    for (const slug of SITE_ICON_SLUGS) {
      const url = serviceUrl(siteIcon(slug)!.title);
      if (url) expect(siteIconSlug(url, ""), slug).toBe(slug);
    }
  });
});
