import type { BrowserModuleContribution } from "./module-contracts.js";

const loaded = import.meta.glob<{ browserContribution: BrowserModuleContribution }>("../modules/*/experience/browser.tsx", { eager: true });
export const browserModules = Object.values(loaded).map((item) => item.browserContribution).sort((a, b) => a.moduleId.localeCompare(b.moduleId));
