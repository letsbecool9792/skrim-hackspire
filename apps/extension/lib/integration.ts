import type { Action, ScreenElement } from "@skrim/schema";
import type { PageObservationMessage } from "./messages.ts";

export interface ScreenGraphSnapshot {
  elements: ScreenElement[];
  registry: Map<string, Element>;
  hasVisualCapture: boolean;
}

export type ScreenGraphProvider = () => ScreenGraphSnapshot | Promise<ScreenGraphSnapshot>;
export type TokenResolver = (value: string) => string | null;
export type ActionPlanner = (input: {
  goal: string;
  observation: PageObservationMessage;
}) => Action | Promise<Action | null> | null;

let screenGraphProvider: ScreenGraphProvider | null = null;
let tokenResolver: TokenResolver | null = null;
let actionPlanner: ActionPlanner | null = null;

export function registerScreenGraphProvider(provider: ScreenGraphProvider | null): void {
  screenGraphProvider = provider;
}

export function getScreenGraphProvider(): ScreenGraphProvider | null {
  return screenGraphProvider;
}

export function registerTokenResolver(resolver: TokenResolver | null): void {
  tokenResolver = resolver;
}

export function getTokenResolver(): TokenResolver | undefined {
  return tokenResolver ?? undefined;
}

export function registerActionPlanner(planner: ActionPlanner | null): void {
  actionPlanner = planner;
}

export function getActionPlanner(): ActionPlanner | null {
  return actionPlanner;
}
