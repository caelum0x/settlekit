/**
 * Theme stylesheet locator.
 *
 * The design-system CSS ships as a static asset and is imported by apps via
 * the package subpath export:
 *
 *   import "@settlekit/ui/theme.css";
 *
 * Bundler-agnostic tooling that needs the literal specifier (e.g. to inject a
 * <link> or copy the file) can reference {@link THEME_CSS_IMPORT}.
 */

/** The import specifier apps should use to include the unified theme. */
export const THEME_CSS_IMPORT = "@settlekit/ui/theme.css" as const;

/** The package-relative path of the theme stylesheet within this package. */
export const THEME_CSS_PATH = "src/theme.css" as const;
