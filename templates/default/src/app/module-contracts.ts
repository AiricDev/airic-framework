import type { DomainProvider, ModuleManifest } from "@airic/framework";
import type { ReactNode } from "react";
import type { AppRoute } from "./application-handler.js";

export interface ServerModuleContribution {
  routes: readonly AppRoute[];
  domain?: DomainProvider;
  services?: Readonly<Record<string, unknown>>;
  close?(): Promise<void>;
}

export interface ServerModuleContext {
  root: string;
  data: string;
  getService<T>(moduleId: string, serviceId: string): T;
}

export interface BrowserModuleContribution {
  moduleId: string;
  navigation: readonly { to: string; label: string }[];
  routes: readonly { path: string; element: ReactNode }[];
  resultViews?: readonly import("@airic/ui").ResultView[];
  workStarters?: readonly import("@airic/ui").WorkStarter[];
}

export interface LoadedServerModule { manifest: ModuleManifest; contribution?: ServerModuleContribution }
