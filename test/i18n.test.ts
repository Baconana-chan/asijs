import { describe, test, expect } from "bun:test";
import {
  I18n,
  i18n,
  createTranslator,
  mergeTranslations,
  dateFormats,
  numberFormats,
} from "../src/i18n";
import { mockContext } from "../src/testing";

describe("I18n", () => {
  const translations = {
    en: {
      greeting: "Hello, {{name}}!",
      welcome: "Welcome",
      items: {
        zero: "No items",
        one: "{{count}} item",
        other: "{{count}} items",
      },
      nested: {
        deep: {
          message: "Deep message",
        },
      },
    },
    ru: {
      greeting: "Привет, {{name}}!",
      welcome: "Добро пожаловать",
      items: {
        zero: "Нет предметов",
        one: "{{count}} предмет",
        few: "{{count}} предмета",
        many: "{{count}} предметов",
        other: "{{count}} предметов",
      },
    },
    ja: {
      greeting: "こんにちは、{{name}}さん！",
      welcome: "ようこそ",
      items: {
        other: "{{count}}個のアイテム",
      },
    },
  };

  describe("I18n class", () => {
    test("basic translation", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru", "ja"],
        translations,
      });

      expect(i18nInstance.translate("en", "welcome")).toBe("Welcome");
      expect(i18nInstance.translate("ru", "welcome")).toBe("Добро пожаловать");
      expect(i18nInstance.translate("ja", "welcome")).toBe("ようこそ");
    });

    test("interpolation", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru"],
        translations,
      });

      expect(i18nInstance.translate("en", "greeting", { name: "World" })).toBe(
        "Hello, World!",
      );
      expect(i18nInstance.translate("ru", "greeting", { name: "Мир" })).toBe(
        "Привет, Мир!",
      );
    });

    test("pluralization - English", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en"],
        translations,
      });

      expect(i18nInstance.translate("en", "items", {}, 0)).toBe("No items");
      expect(i18nInstance.translate("en", "items", {}, 1)).toBe("1 item");
      expect(i18nInstance.translate("en", "items", {}, 5)).toBe("5 items");
    });

    test("pluralization - Russian (complex rules)", () => {
      const i18nInstance = new I18n({
        defaultLocale: "ru",
        locales: ["ru"],
        translations,
      });

      expect(i18nInstance.translate("ru", "items", {}, 0)).toBe(
        "Нет предметов",
      );
      expect(i18nInstance.translate("ru", "items", {}, 1)).toBe("1 предмет");
      expect(i18nInstance.translate("ru", "items", {}, 2)).toBe("2 предмета");
      expect(i18nInstance.translate("ru", "items", {}, 5)).toBe("5 предметов");
      expect(i18nInstance.translate("ru", "items", {}, 21)).toBe("21 предмет");
    });

    test("nested keys with dot notation", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en"],
        translations,
      });

      expect(i18nInstance.translate("en", "nested.deep.message")).toBe(
        "Deep message",
      );
    });

    test("fallback to key when translation missing", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en"],
        translations,
      });

      expect(i18nInstance.translate("en", "missing.key")).toBe("missing.key");
    });

    test("fallback locale", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ja"],
        translations,
        fallbackLocale: "en",
      });

      // ja doesn't have nested.deep.message, should fallback to en
      expect(i18nInstance.translate("ja", "nested.deep.message")).toBe(
        "Deep message",
      );
    });

    test("RTL detection", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ar", "he"],
        translations: { en: {}, ar: {}, he: {} },
      });

      expect(i18nInstance.isRTL("en")).toBe(false);
      expect(i18nInstance.isRTL("ar")).toBe(true);
      expect(i18nInstance.isRTL("he")).toBe(true);
    });
  });

  describe("Locale detection", () => {
    test("detect from Accept-Language header", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru", "ja"],
        translations,
      });

      const ctx = mockContext({
        headers: { "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8" },
      });

      expect(i18nInstance.detectLocale(ctx)).toBe("ru");
    });

    test("detect from query parameter", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru", "ja"],
        translations,
        detection: { order: ["query", "header"] },
      });

      const ctx = mockContext({
        url: "/?lang=ja",
        query: { lang: "ja" },
      });

      expect(i18nInstance.detectLocale(ctx)).toBe("ja");
    });

    test("detect from cookie", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru", "ja"],
        translations,
        detection: { order: ["cookie", "header"] },
      });

      const ctx = mockContext({
        cookies: { locale: "ru" },
      });

      expect(i18nInstance.detectLocale(ctx)).toBe("ru");
    });

    test("fallback to default when not detected", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru"],
        translations,
      });

      const ctx = mockContext({
        headers: { "Accept-Language": "fr-FR" },
      });

      expect(i18nInstance.detectLocale(ctx)).toBe("en");
    });
  });

  describe("Formatting", () => {
    test("format number", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en", "ru"],
        translations,
      });

      const formatted = i18nInstance.formatNumber("en", 1234567.89);
      expect(formatted).toContain("1");
      expect(formatted).toContain("234");
    });

    test("format date", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en"],
        translations,
      });

      const date = new Date("2025-01-15");
      const formatted = i18nInstance.formatDate("en", date, dateFormats.medium);
      expect(formatted).toContain("2025");
    });

    test("format currency", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en"],
        translations,
      });

      const formatted = i18nInstance.formatCurrency("en", 99.99, "USD");
      expect(formatted).toContain("99");
      expect(formatted).toContain("$");
    });

    test("format list", () => {
      const i18nInstance = new I18n({
        defaultLocale: "en",
        locales: ["en"],
        translations,
      });

      const formatted = i18nInstance.formatList("en", [
        "apples",
        "oranges",
        "bananas",
      ]);
      expect(formatted).toContain("apples");
      expect(formatted).toContain("oranges");
      expect(formatted).toContain("bananas");
    });
  });

  describe("createTranslator helper", () => {
    test("creates standalone translator function", () => {
      const t = createTranslator(translations, "en");

      expect(t("welcome")).toBe("Welcome");
      expect(t("greeting", { name: "Test" })).toBe("Hello, Test!");
      expect(t("items", {}, 3)).toBe("3 items");
    });
  });

  describe("mergeTranslations helper", () => {
    test("merges translations", () => {
      const base = {
        en: { hello: "Hello", world: "World" },
      };
      const override = {
        en: { hello: "Hi", newKey: "New" },
        ru: { hello: "Привет" },
      };

      const merged = mergeTranslations(base, override);

      expect(merged.en.hello).toBe("Hi");
      expect(merged.en.world).toBe("World");
      expect((merged.en as Record<string, string>).newKey).toBe("New");
      expect(merged.ru.hello).toBe("Привет");
    });
  });

  describe("Number format presets", () => {
    test("presets are defined", () => {
      expect(numberFormats.decimal).toBeDefined();
      expect(numberFormats.percent).toBeDefined();
      expect(numberFormats.compact).toBeDefined();
    });
  });
});
