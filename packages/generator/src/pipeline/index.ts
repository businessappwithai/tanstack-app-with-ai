import { setLanguageDefinition as setCheckerDefinition } from "../../../../language";
import languageDefinition from "../../../../language/appwithai-language.json";

// The checker reads appwithai-language.json from beside its own source file, and a
// bundled dist/ has no such file: `reviewModel` from the built package failed with
// ENOENT. Hand it the inlined copy, as the browser entries do, so the definition
// is the file in language/ either way.
setCheckerDefinition(languageDefinition as unknown as Parameters<typeof setCheckerDefinition>[0]);

export * from "./generate-application";
export { type Issue, type ModelReview, reviewModel } from "./review-model";
