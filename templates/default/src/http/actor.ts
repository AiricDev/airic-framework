import type { IncomingMessage } from "node:http";
import type { AppActor } from "./application-handler.js";

/**
 * The application host owns authentication: the trusted actor is established here
 * from host configuration and is shared by the business API and the Airic handler.
 * HTTP input (bodies, query strings) can never override the actor, its scopes or
 * a command identity.
 */
export async function resolveActor(_request: IncomingMessage): Promise<AppActor> {
  // The scaffold binds only to loopback and deliberately uses one fixed local actor.
  // Replace this function with a verified session or trusted-proxy adapter in production.
  return { id: "local-user", scopes: ["app:local"] };
}
